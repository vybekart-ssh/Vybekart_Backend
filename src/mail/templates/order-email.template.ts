import {
  buildVybeKartMailShellHtml,
  escapeHtml,
  formatInr,
  VybeKartMailBranding,
} from './vybekart-email-layout';

export type OrderEmailLine = {
  productName: string;
  variantLabel: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  imageUrl: string;
};

export type OrderEmailPayload = {
  orderId: string;
  orderShortId: string;
  status: string;
  placedAt: string;
  paymentMethod: string;
  paymentReference: string | null;
  shippingAddress: string;
  streamTitle: string | null;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  deliveryProvider: string | null;
  items: OrderEmailLine[];
  buyerName: string;
  sellerBusinessName: string;
};

function metaRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 14px;border-bottom:1px solid #e8ecf1;font-size:13px;color:#64748b;width:36%;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #e8ecf1;font-size:14px;color:#0f172a;font-weight:500;vertical-align:top;">${value}</td>
  </tr>`;
}

function orderMetaTable(rows: { label: string; value: string }[]): string {
  const body = rows
    .map((r) => metaRow(r.label, r.value))
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 22px;">
    ${body}
  </table>`;
}

function lineItemsHtml(items: OrderEmailLine[]): string {
  const rows = items
    .map((item) => {
      const img = item.imageUrl
        ? `<img src="${escapeHtml(item.imageUrl)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;"/>`
        : `<div style="width:64px;height:64px;border-radius:8px;background:linear-gradient(135deg,#1E88E5,#1565C0);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;text-align:center;padding:4px;">VybeKart</div>`;
      const variant = item.variantLabel
        ? `<div style="font-size:12px;color:#64748b;margin-top:2px;">${escapeHtml(item.variantLabel)}</div>`
        : '';
      return `<tr>
        <td style="padding:14px 12px;border-bottom:1px solid #e8ecf1;vertical-align:top;width:76px;">${img}</td>
        <td style="padding:14px 8px;border-bottom:1px solid #e8ecf1;vertical-align:top;">
          <div style="font-size:15px;font-weight:600;color:#0f172a;">${escapeHtml(item.productName)}</div>
          ${variant}
          <div style="font-size:13px;color:#64748b;margin-top:6px;">Qty ${item.quantity} × ${escapeHtml(formatInr(item.unitPrice))}</div>
        </td>
        <td style="padding:14px 12px;border-bottom:1px solid #e8ecf1;vertical-align:top;text-align:right;white-space:nowrap;">
          <div style="font-size:15px;font-weight:700;color:#1565C0;">${escapeHtml(formatInr(item.lineTotal))}</div>
        </td>
      </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 20px;">
    <tr>
      <td colspan="3" style="padding:12px 14px;background:#f8fafc;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Order summary</td>
    </tr>
    ${rows}
  </table>`;
}

function totalsBlock(
  subtotal: number,
  deliveryFee: number,
  total: number,
): string {
  const shipping =
    deliveryFee > 0
      ? formatInr(deliveryFee)
      : '<span style="color:#16a34a;font-weight:600;">Free</span>';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;">
    <tr><td style="padding:6px 0;font-size:14px;color:#64748b;">Subtotal</td><td style="padding:6px 0;font-size:14px;color:#0f172a;text-align:right;font-weight:500;">${escapeHtml(formatInr(subtotal))}</td></tr>
    <tr><td style="padding:6px 0;font-size:14px;color:#64748b;">Shipping</td><td style="padding:6px 0;font-size:14px;text-align:right;">${shipping}</td></tr>
    <tr><td style="padding:10px 0 6px;font-size:16px;font-weight:700;color:#0B1E5B;">Total paid</td><td style="padding:10px 0 6px;font-size:18px;font-weight:700;color:#1565C0;text-align:right;">${escapeHtml(formatInr(total))}</td></tr>
  </table>`;
}

export function buildBuyerOrderConfirmationEmail(
  branding: VybeKartMailBranding,
  recipientEmail: string,
  order: OrderEmailPayload,
): { subject: string; html: string; text: string } {
  const subject = `Order confirmed — #${order.orderShortId} | VybeKart`;
  const paymentRef = order.paymentReference
    ? escapeHtml(order.paymentReference)
    : '—';

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.55;">Hi ${escapeHtml(order.buyerName)},</p>
    <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.55;">Thank you for shopping on VybeKart. Your payment was successful and we have confirmed your order. The seller partner will prepare your items for dispatch shortly.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;margin-bottom:22px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 4px;font-size:12px;color:#0369a1;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">Order reference</p>
        <p style="margin:0;font-size:22px;font-weight:700;color:#0B1E5B;letter-spacing:0.03em;">#${escapeHtml(order.orderShortId)}</p>
        <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Placed ${escapeHtml(order.placedAt)} · Status: <strong>${escapeHtml(order.status)}</strong></p>
      </td></tr>
    </table>
    ${orderMetaTable([
      { label: 'Payment', value: escapeHtml(order.paymentMethod) },
      { label: 'Payment reference', value: paymentRef },
      ...(order.streamTitle
        ? [{ label: 'Live show', value: escapeHtml(order.streamTitle) }]
        : []),
      {
        label: 'Delivery to',
        value: escapeHtml(order.shippingAddress).replace(/\n/g, '<br/>'),
      },
    ])}
    ${lineItemsHtml(order.items)}
    ${totalsBlock(order.subtotal, order.deliveryFee, order.totalAmount)}
    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">Track your order in the VybeKart app under <strong>Orders</strong>. For help, email <a href="mailto:${escapeHtml(branding.supportEmail)}" style="color:#FF5722;font-weight:600;">${escapeHtml(branding.supportEmail)}</a>.</p>
  `;

  const html = buildVybeKartMailShellHtml({
    branding,
    recipientEmail,
    headerBadge: 'Order confirmed',
    headerTitle: 'Your VybeKart order is confirmed',
    headerSubtitle: `Order #${order.orderShortId}`,
    bodyHtml,
    whyReceivedHtml:
      'You placed an order on VybeKart and this confirmation was sent to your registered email.',
  });

  const text = [
    `Hi ${order.buyerName},`,
    '',
    `Your VybeKart order #${order.orderShortId} is confirmed.`,
    `Status: ${order.status}`,
    `Placed: ${order.placedAt}`,
    `Payment: ${order.paymentMethod}`,
    order.paymentReference ? `Reference: ${order.paymentReference}` : '',
    '',
    `Ship to: ${order.shippingAddress}`,
    '',
    'Items:',
    ...order.items.map(
      (i) =>
        `- ${i.productName}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.quantity} = ${formatInr(i.lineTotal)}`,
    ),
    '',
    `Subtotal: ${formatInr(order.subtotal)}`,
    `Shipping: ${order.deliveryFee > 0 ? formatInr(order.deliveryFee) : 'Free'}`,
    `Total: ${formatInr(order.totalAmount)}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { subject, html, text };
}

export function buildSellerNewOrderEmail(
  branding: VybeKartMailBranding,
  recipientEmail: string,
  order: OrderEmailPayload,
): { subject: string; html: string; text: string } {
  const subject = `New order — #${order.orderShortId} | VybeKart Seller`;
  const paymentRef = order.paymentReference
    ? escapeHtml(order.paymentReference)
    : '—';

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;color:#334155;line-height:1.55;">Hello ${escapeHtml(order.sellerBusinessName)},</p>
    <p style="margin:0 0 20px;font-size:15px;color:#334155;line-height:1.55;">You have received a <strong>new paid order</strong> from a VybeKart shopper. Please prepare and pack the items, then update shipping in your seller partner app.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ecfdf5;border-radius:8px;border:1px solid #86efac;margin-bottom:22px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 4px;font-size:12px;color:#166534;text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">New order</p>
        <p style="margin:0;font-size:22px;font-weight:700;color:#0B1E5B;letter-spacing:0.03em;">#${escapeHtml(order.orderShortId)}</p>
        <p style="margin:8px 0 0;font-size:12px;color:#64748b;">${escapeHtml(order.placedAt)} · Buyer: ${escapeHtml(order.buyerName)}</p>
      </td></tr>
    </table>
    ${orderMetaTable([
      { label: 'Buyer', value: escapeHtml(order.buyerName) },
      { label: 'Payment', value: `${escapeHtml(order.paymentMethod)} (confirmed)` },
      { label: 'Payment reference', value: paymentRef },
      ...(order.streamTitle
        ? [{ label: 'Live show', value: escapeHtml(order.streamTitle) }]
        : []),
      {
        label: 'Ship to',
        value: escapeHtml(order.shippingAddress).replace(/\n/g, '<br/>'),
      },
      ...(order.deliveryProvider
        ? [{ label: 'Delivery partner', value: escapeHtml(order.deliveryProvider) }]
        : []),
    ])}
    ${lineItemsHtml(order.items)}
    ${totalsBlock(order.subtotal, order.deliveryFee, order.totalAmount)}
    <p style="margin:0;font-size:13px;color:#64748b;line-height:1.5;">Open the <strong>VybeKart Seller Partner</strong> app → Orders to accept, pack, and request delivery.</p>
  `;

  const html = buildVybeKartMailShellHtml({
    branding,
    recipientEmail,
    headerBadge: 'Seller partner',
    headerTitle: 'New order received',
    headerSubtitle: `Order #${order.orderShortId} · ${formatInr(order.totalAmount)}`,
    bodyHtml,
    whyReceivedHtml:
      'A customer placed an order for products from your VybeKart store and this alert was sent to your registered seller email.',
  });

  const text = [
    `Hello ${order.sellerBusinessName},`,
    '',
    `New paid order #${order.orderShortId} from ${order.buyerName}.`,
    `Placed: ${order.placedAt}`,
    `Ship to: ${order.shippingAddress}`,
    '',
    'Items:',
    ...order.items.map(
      (i) =>
        `- ${i.productName}${i.variantLabel ? ` (${i.variantLabel})` : ''} × ${i.quantity} = ${formatInr(i.lineTotal)}`,
    ),
    '',
    `Total (incl. shipping): ${formatInr(order.totalAmount)}`,
  ].join('\n');

  return { subject, html, text };
}
