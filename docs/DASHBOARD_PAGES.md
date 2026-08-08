# Public dashboard on GitHub Pages (option B)

Firmware stays in the **private** repo. Only `web/ble_plotter/` is published to a
**public** repository so Chrome can load it over HTTPS.

## Target URLs

| Item | Value |
|------|--------|
| Public repo | `https://github.com/MHYeung/ESP32C3_MotionTracking_Dashboard` |
| Site (after Pages is on) | `https://mhyeung.github.io/ESP32C3_MotionTracking_Dashboard/` |
| Workflow | `.github/workflows/deploy-dashboard.yml` |

Web Bluetooth requires HTTPS (or localhost). GitHub Pages satisfies that.

## One-time setup (you do this in the browser)

### 1. Create the public repo

1. GitHub → **New repository**
2. Name: `ESP32C3_MotionTracking_Dashboard`
3. Visibility: **Public**
4. Do **not** add a README/license (empty is fine)
5. Create

### 2. Create a deploy token

1. GitHub → **Settings → Developer settings → Personal access tokens**
2. Prefer a **fine-grained** token:
   - Resource owner: your user
   - Repository access: **Only** `ESP32C3_MotionTracking_Dashboard`
   - Permissions: **Contents = Read and write**
3. Copy the token once

### 3. Add the secret on the private repo

1. Open private repo `ESP32C3_MotionTracking_Gadget`
2. **Settings → Secrets and variables → Actions → New repository secret**
3. Name: `DASHBOARD_DEPLOY_TOKEN`
4. Value: the token from step 2

### 4. Enable Pages on the public repo

After the first successful workflow run (or after it creates `gh-pages`):

1. Open `ESP32C3_MotionTracking_Dashboard`
2. **Settings → Pages**
3. Source: **Deploy from a branch**
4. Branch: `gh-pages` / folder `/ (root)` → Save

Wait ~1 minute, then open:

`https://mhyeung.github.io/ESP32C3_MotionTracking_Dashboard/?v=7`

Use Chrome or Edge. Hard-refresh if scripts look stale.

### 5. Trigger a deploy

- Push a change under `web/ble_plotter/`, or
- **Actions → Deploy dashboard → Run workflow**

## Security notes

- The published site is **public** (anyone with the URL can open the UI).
- It cannot flash your pods by itself; BLE still needs physical proximity + user gesture.
- Do **not** put firmware, keys, or private schematic PDFs into `web/ble_plotter/`.
- Rotate `DASHBOARD_DEPLOY_TOKEN` if it leaks.

## Local fallback

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/?v=7`.
