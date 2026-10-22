# Cloud-to-Windows Toast Notification System

A Node.js/Express backend sends authenticated notification events over Socket.IO to a Windows agent. The agent runs in the signed-in Windows user's session and uses PowerShell + BurntToast to display native Windows toast notifications.

## Architecture

```text
Trusted application / webhook
        |
        | HTTPS POST /api/notifications (Bearer API_KEY)
        v
Cloud Node.js + Express + Socket.IO
        |
        | outbound Socket.IO connection (TLS in production)
        v
Windows agent (interactive user session)
        |
        v
PowerShell + BurntToast -> Windows toast
```

The agent makes an outbound connection, so you normally do not need to open an inbound port on your router.

## Requirements

- Node.js 20 or newer on the backend and Windows computer.
- Windows 10/11 for the toast agent.
- PowerShell and permission to install the BurntToast module.
- A hosting provider that supports persistent WebSocket connections for Socket.IO.
- HTTPS in production.

## Project structure

```text
notification-system/
├── README.md
├── .gitignore
├── cloud-backend/
│   ├── .env.example
│   ├── package.json
│   └── server.js
└── windows-agent/
    ├── .env.example
    ├── package.json
    ├── agent.js
    ├── show-toast.ps1
    └── install-burnttoast.ps1
```

## 1. Configure the cloud backend

Open a terminal in `cloud-backend`:

```powershell
npm install
```

Copy `.env.example` to `.env` and generate two separate secrets. Run this command twice:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put one value in `API_KEY` and the other in `DEVICE_TOKEN`. Do not commit `.env`.

Example `cloud-backend/.env`:

```dotenv
PORT=3000
HOST=127.0.0.1
API_KEY=paste_first_random_secret_here
DEVICE_TOKEN=paste_second_random_secret_here
DEVICE_ID=my-windows-pc
CORS_ORIGIN=
```

Start the server:

```powershell
npm start
```

For local testing, the server binds to `127.0.0.1` by default. The Windows agent can connect to it on the same computer. If testing across computers on a trusted LAN, set `HOST=0.0.0.0` and configure your firewall carefully.

## 2. Configure the Windows agent

Open a second terminal in `windows-agent`:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `windows-agent/.env`:
- `BACKEND_URL=http://localhost:3000` for same-computer testing.
- Use the same `DEVICE_ID` and `DEVICE_TOKEN` values as the backend.
- Never put the `API_KEY` in the agent.

Install BurntToast for the Windows account that will receive notifications. Run PowerShell as that user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
.\install-burnttoast.ps1
```

Test BurntToast directly:

```powershell
Import-Module BurntToast
New-BurntToastNotification -Text "Test notification", "If you can see this, toast notifications work."
```

Start the agent in a normal interactive PowerShell/terminal window:

```powershell
npm start
```

Leave it running while testing. Toasts may not display if the agent is launched as a non-interactive Windows service or in a session without a signed-in desktop user.

## 3. Send a test notification

Open a third terminal. Replace `YOUR_API_KEY` with the `API_KEY` from the backend `.env`:

```powershell
$body = @{
  title = "New Support Ticket"
  message = "Ticket #1042 requires your attention."
  deviceId = "my-windows-pc"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://localhost:3000/api/notifications" `
  -Method Post `
  -Headers @{ Authorization = "Bearer YOUR_API_KEY" } `
  -ContentType "application/json" `
  -Body $body
```

The API waits briefly for the agent's acknowledgement after it runs the PowerShell toast command. An acknowledgement means the PowerShell command exited successfully; Windows does not provide a definitive guarantee that a person saw the notification.

Health check:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

## 4. Deploy the backend

For a cloud deployment such as Render:

1. Push `cloud-backend` to a private Git repository.
2. Create a Web Service using the `cloud-backend` folder as its root directory.
3. Build command: `npm install`
4. Start command: `npm start`
5. Set `API_KEY`, `DEVICE_TOKEN`, and `DEVICE_ID` as hosting environment variables.
6. Set `HOST=0.0.0.0` for the hosted service. The hosting platform provides the port in `PORT`.
7. Use the service's HTTPS URL as `BACKEND_URL` in the Windows agent.
8. Update the agent's `DEVICE_TOKEN` and `DEVICE_ID` to match the backend settings.

The hosting provider must support WebSocket connections. Do not expose the local prototype over plain HTTP to the public internet. For a hosted deployment, the client connection should use HTTPS/WSS via the provider's HTTPS URL.

## 5. Start the agent at Windows sign-in

First verify that the agent works when started manually. Then use Task Scheduler:

1. Open Task Scheduler.
2. Choose **Create Task**.
3. Under **General**, choose your Windows account and select **Run only when user is logged on**.
4. Under **Triggers**, create an **At log on** trigger.
5. Under **Actions**, choose **Start a program**.
6. Program: path to `node.exe` (find it with `where.exe node`).
7. Arguments: full path to `windows-agent\\agent.js`.
8. Start in: full path to the `windows-agent` directory.
9. Save and test the task while signed in.

The agent loads `.env` from its own project directory. Do not select “Run whether user is logged on or not” for a toast process that needs the interactive desktop.

## API

### `GET /health`
Returns basic health status and whether the configured agent is connected. Do not treat this endpoint as a complete monitoring/diagnostics system.

### `POST /api/notifications`
Authentication: `Authorization: Bearer <API_KEY>`

JSON body:

```json
{
  "title": "New Support Ticket",
  "message": "Ticket #1042 requires attention.",
  "deviceId": "my-windows-pc"
}
```

- `title`: required string, maximum 150 characters.
- `message`: required string, maximum 1000 characters.
- `deviceId`: optional; defaults to the configured device ID.
- Returns `202` when the agent acknowledged the toast command.
- Returns `503` if the agent is offline or did not acknowledge in time.

Example response:

```json
{
  "accepted": true,
  "notificationId": "generated-uuid",
  "acknowledged": true
}
```

## Troubleshooting

- **No toast appears:** test BurntToast directly; check Windows Settings → System → Notifications; check Do Not Disturb/Focus; run the agent in the signed-in user's session.
- **Agent cannot connect:** verify `BACKEND_URL`, the backend is running, and the `DEVICE_ID`/`DEVICE_TOKEN` match.
- **Unauthorized device:** compare device token values without sharing them publicly.
- **API returns 503:** start the agent and inspect its console.
- **Cloud deployment fails:** verify the service supports WebSockets and is listening on `0.0.0.0` using the platform-provided `PORT`.
- **PowerShell policy blocks script:** follow your organization's execution policy. Do not broadly weaken execution policy on a managed machine without approval.

## Production hardening still recommended

This is a practical starter, not a complete enterprise notification platform. Before production use, consider:
- Per-user/per-device identities and token rotation instead of a single shared device credential.
- Persistent queues and delivery retries for offline devices.
- A database-backed event log and idempotency keys.
- Rate limiting at the hosting edge as well as in the app.
- Audit logging, monitoring, alerting, and secret management.
- Webhook signature validation for upstream event providers.
- Separate authentication/authorization for each notification recipient.
- Avoid including sensitive personal, customer, or incident data in toast messages.
