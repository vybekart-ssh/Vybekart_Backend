# Run LiveKit natively on Windows (fix "could not establish pc connection")

When Docker keeps failing with "could not establish pc connection", run the LiveKit server **directly on Windows** (no Docker) so UDP port 7882 is bound on the host.

## Step-by-step

### 1. Download

- Open **[github.com/livekit/livekit/releases](https://github.com/livekit/livekit/releases)**.
- Download **livekit_*_windows_amd64.zip** (or `livekit_*_windows_arm64.zip` on ARM).
- Extract the zip (e.g. to `C:\livekit`). You should see `livekit-server.exe`.

### 2. Open firewall

Open **PowerShell as Administrator** and run:

```powershell
New-NetFirewallRule -DisplayName "LiveKit 7880" -Direction Inbound -Protocol TCP -LocalPort 7880 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "LiveKit 7881 TCP" -Direction Inbound -Protocol TCP -LocalPort 7881 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "LiveKit 7882 UDP" -Direction Inbound -Protocol UDP -LocalPort 7882 -Action Allow -Profile Private
```

### 3. Get your LAN IP

- Run `ipconfig` in a terminal.
- Use the **IPv4 Address** of your Wi‑Fi or Ethernet adapter (e.g. `192.168.1.12`).  
  Ignore `127.0.0.1` (localhost).

### 4. Run LiveKit server

- Open PowerShell or CMD in the folder where you extracted (e.g. `cd C:\livekit`).
- Run (replace `192.168.1.12` with your LAN IP from step 3):

```powershell
.\livekit-server.exe --dev --node-ip 192.168.1.12 --bind 0.0.0.0
```

- **`--bind 0.0.0.0`** is required on Windows so the server listens on your LAN IP (not only localhost). Without it, the log shows `bindAddresses: ["127.0.0.1"]` and the backend gets **ECONNREFUSED** when using `LIVEKIT_URL="http://192.168.1.14:7880"`.
- Leave this window open. You should see the server listening.

### 5. Backend `.env`

In **VybeKart-Backend**, set (use the same IP as in step 4):

```env
LIVEKIT_URL="http://192.168.1.12:7880"
LIVEKIT_API_KEY="devkey"
LIVEKIT_API_SECRET="secret"
```

Restart the backend (`npm run start:dev`).

### 6. Test the viewer

1. **Stop** any Docker LiveKit container if it was running (so ports 7880/7881/7882 are free).
2. On the **phone**: open the app, go **Go Live**, and start the stream.
3. On the **laptop**: open in the browser:
   ```
   http://192.168.1.12:3000/viewer?streamId=YOUR_STREAM_ID
   ```
4. Click **Connect**. The stream should appear.

---

If it still fails, ensure:

- Laptop and phone are on the **same Wi‑Fi**.
- No VPN or extra firewall is blocking 7880, 7881, 7882.
- You are using the **same IP** in `--node-ip`, `LIVEKIT_URL`, and the viewer URL.
