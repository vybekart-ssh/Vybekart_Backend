/**
 * VybeKart — export landing-page registration emails from Gmail into a Sheet (then File → Download CSV).
 *
 * If you see "Rows written: 0", common causes were:
 * - Email + name only appeared in the subject line (not in plain-text body).
 * - Body is HTML-only so getPlainBody() was empty.
 * - Label search string did not match Gmail's internal label name.
 * This version parses subject + HTML body + plain body and tries several searches.
 */

/** Extra queries are merged with these (union of threads, deduped). */
var GMAIL_QUERIES = [
  'label:Vybekart_Registrations',
  'label:vybekart_registrations',
  '(subject:"New Shopper Early Access" OR subject:"New Seller Partner Pre-Registration")',
];

var SHEET_NAME = 'Registrations';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('VybeKart')
    .addItem('Extract registrations from Gmail', 'extractRegistrationsToSheet')
    .addToUi();
}

function stripHtml_(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strict: label at start of line (plain-text style).
 */
function pickField_(body, label) {
  var escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp('^' + escaped + '\\s*:\\s*(.+)$', 'im');
  var m = body.match(re);
  return m ? m[1].replace(/\s+$/, '').trim() : '';
}

/**
 * Loose: "Label: value" anywhere (HTML stripped, one line of value).
 */
function pickFieldLoose_(text, label) {
  var line = pickField_(text, label);
  if (line) return line;
  var escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var re = new RegExp(escaped + '\\s*:\\s*([^\\n\\r<]+?)(?=\\s+[A-Za-z][A-Za-z /]*:\\s|$)', 'i');
  var m = text.match(re);
  if (!m) return '';
  return m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** First email address in text. */
function findEmailInText_(text) {
  var m = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  return m ? m[0].toLowerCase() : '';
}

/**
 * Seller subjects often look like:
 * ... Name: Jane Doe Email: jane@gmail.com ...
 */
function parseNameEmailFromSubject_(subject) {
  var s = subject || '';
  var m = s.match(/Name:\s*(.+?)\s+Email:\s*(\S+@\S+)/i);
  if (m) {
    return {
      name: m[1].replace(/\s+/g, ' ').trim(),
      email: m[2].replace(/[.,;)]+$/, '').toLowerCase().trim(),
    };
  }
  m = s.match(/Name:\s*([^E\n\r]+?)(?:\s+Email:|\s*$)/i);
  if (m) {
    var name = m[1].replace(/\s+/g, ' ').trim();
    var email = findEmailInText_(s);
    if (email) return { name: name, email: email };
    return { name: name, email: '' };
  }
  return null;
}

function registrationTypeFromSubject_(subject) {
  var s = (subject || '').toLowerCase();
  if (s.indexOf('seller partner') !== -1 || (s.indexOf('seller') !== -1 && s.indexOf('shopper') === -1))
    return 'seller';
  if (s.indexOf('shopper') !== -1 || s.indexOf('buyer') !== -1) return 'buyer';
  return 'unknown';
}

/** All threads matching any query, deduped by thread id. */
function gatherThreads_() {
  var byId = {};
  for (var q = 0; q < GMAIL_QUERIES.length; q++) {
    var threads = GmailApp.search(GMAIL_QUERIES[q], 0, 200);
    for (var i = 0; i < threads.length; i++) {
      var id = threads[i].getId();
      if (!byId[id]) byId[id] = threads[i];
    }
  }
  var out = [];
  for (var k in byId) out.push(byId[k]);
  return out;
}

/** One string with plain body, stripped HTML, and subject (best effort for parsing). */
function buildParseText_(msg) {
  var plain = msg.getPlainBody() || '';
  var html = stripHtml_(msg.getBody() || '');
  var sub = msg.getSubject() || '';
  return plain + '\n' + html + '\n' + sub;
}

function extractRowFromMessage_(msg) {
  var subject = msg.getSubject() || '';
  var parseText = buildParseText_(msg);

  var email =
    pickFieldLoose_(parseText, 'Email').toLowerCase() ||
    findEmailInText_(parseText) ||
    '';

  var name =
    pickFieldLoose_(parseText, 'Name') ||
    '';

  if (!email || email.indexOf('@') === -1) {
    var fromSub = parseNameEmailFromSubject_(subject);
    if (fromSub) {
      if (fromSub.email) email = fromSub.email;
      if (fromSub.name && !name) name = fromSub.name;
    }
  }

  if (!email || email.indexOf('@') === -1) {
    return null;
  }

  if (!name) {
    var subOnly = parseNameEmailFromSubject_(subject);
    if (subOnly && subOnly.name) name = subOnly.name;
  }

  var regType = registrationTypeFromSubject_(subject);
  var phone = pickFieldLoose_(parseText, 'Phone');
  var city =
    pickFieldLoose_(parseText, 'City / area') ||
    pickFieldLoose_(parseText, 'City') ||
    pickFieldLoose_(parseText, 'City/area');
  var age = pickFieldLoose_(parseText, 'Age') || pickFieldLoose_(parseText, 'Age band');
  var gender = pickFieldLoose_(parseText, 'Gender');
  var interests = pickFieldLoose_(parseText, 'Interests');

  return {
    registration_type: regType,
    name: name,
    email: email,
    phone: phone,
    city: city,
    age_band: age,
    gender: gender,
    interests: interests,
    received_at: msg.getDate(),
    gmail_message_id: msg.getId(),
    subject: subject,
  };
}

function extractRegistrationsToSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('Run this from a Google Sheet (Extensions → Apps Script bound to the spreadsheet).');
  }
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  sheet.clearContents();
  var headers = [
    'registration_type',
    'name',
    'email',
    'phone',
    'city',
    'age_band',
    'gender',
    'interests',
    'received_at',
    'gmail_message_id',
    'subject',
  ];
  sheet.appendRow(headers);

  var threads = gatherThreads_();
  var seen = {};
  var rowCount = 0;
  var skippedNoEmail = 0;

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    var msg = messages[messages.length - 1];
    var row = extractRowFromMessage_(msg);
    if (!row) {
      skippedNoEmail++;
      continue;
    }
    var key = row.email.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;

    var received = row.received_at;
    sheet.appendRow([
      row.registration_type,
      row.name,
      row.email,
      row.phone,
      row.city,
      row.age_band,
      row.gender,
      row.interests,
      received
        ? Utilities.formatDate(received, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
        : '',
      row.gmail_message_id,
      row.subject,
    ]);
    rowCount++;
  }

  var msg =
    'Done. Rows written: ' +
    rowCount +
    '\nThreads scanned: ' +
    threads.length +
    (skippedNoEmail ? '\nMessages skipped (no email found): ' + skippedNoEmail : '') +
    '\n\nFile → Download → Comma-separated values (.csv)';
  SpreadsheetApp.getUi().alert(msg);
}
