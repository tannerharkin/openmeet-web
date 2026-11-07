# OpenMeet Web

Control panel for the Shokz OpenMeet headset through its Loop120 USB dongle, running entirely in the browser over [WebHID](https://developer.mozilla.org/docs/Web/API/WebHID_API). No install, no driver, no account.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshot-dark.png">
  <img src="docs/screenshot-light.png" alt="OpenMeet Web showing battery, settings and paired devices" width="720">
</picture>

- See the current headset status (battery, devices paired, etc.)
- Access to standard headset settings: equalizer, prompts and prompt volume, button sounds, busy light, mute reminder, focus mode, auto power off, multipoint, computer-audio priority
- Pairing list: connect, disconnect and forget devices, put the headset in pairing mode, connect a brand new Loop120 with a headset
- Detailed diagnostics log for those who like to tinker

Supported: OpenMeet (C610). OpenMeet 2 (C62x) is supported on a best-effort basis.

## Usage

Open the page in Chrome or Edge on a computer (WebHID is currently unavailable in Firefox, Safari and on phones and tablets, which get a page explaining this with a button to send the link to a computer), plug in your Loop120 dongle, and select **Connect dongle**. The browser will prompt you to select your Loop120 dongle. If you have the Shokz Connect app installed, please ensure to exit it entirely before using this tool as they will conflict.

## Development

```sh
npm install
npm run dev    # standard Vite test server
npm run build  # build to dist/index.html
```

`dev/fake-hid.js` is a simulated dongle and headset. Inject as an init script (e.g. with Puppeteer's `evaluateOnNewDocument`) for testing the UI without hardware.

## How it works

The dongle exposes a HID collection (usage page `0x0C`, usage `0x01`) that carries a small vendor protocol alongside the ordinary media keys. Each command is a framed, CRC-checked TLV sent on output report `0x12` (dongle) or `0x14` (headset); replies and unsolicited notifications arrive on `0x13` / `0x15`. Headset commands are relayed by the dongle over a Bluetooth SPP channel.

- `src/protocol/frames.ts`: constants, framing, CRC, notification decoding
- `src/protocol/dongle.ts`: WebHID transport: one request at a time, replies matched by tag
- `src/protocol/commands.ts`: the commands and how their replies are read
- `src/store.ts`: application state and the actions the UI calls
- `src/components/`: the interface (React, Tailwind, shadcn/ui)

## Security & privacy

There is no backend, account or telemetry. The page is a single file served from its own origin (React included) and contacts nothing else; a saved copy works offline.

It stores only UI preferences in `localStorage` (`shokz-theme`, `shokz-diagnostics-open`) and a `sessionStorage` flag remembering that you disconnected manually. Device data (Bluetooth addresses and names of paired devices) stays in the browser, except when you copy or download the diagnostics log, which contains them.

The browser remembers the dongle permission, so the page reconnects automatically on later visits. To revoke it, use **Forget this dongle**, or remove the device under site settings → HID devices in Chrome/Edge (`chrome://settings/content/hidDevices`).

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[Standard MIT License](LICENSE)
