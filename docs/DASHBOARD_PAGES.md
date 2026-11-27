# Dashboard on GitHub Pages

Actions publishes the static files under `web/ble_plotter/`. Firmware stays
in the repository and is not the Pages artifact.

## URL

RowPod **1.5.6** is the site root:

`https://mhyeung.github.io/RowPod/?v=1.5.6`

IMU lab (plots, orientation, HYROX, session CSV, battery):

`https://mhyeung.github.io/RowPod/lab.html?v=16.13`

Old `rowpod.html` bookmarks redirect to `index.html`. Chrome or Edge.
Hard-refresh if scripts look stale.

The page needs Chrome or Edge. Bluetooth still needs a nearby pod and a browser gesture.

## One-time setup

1. Open  
   `https://github.com/MHYeung/RowPod/settings/pages`
2. **Build and deployment → Source:** **GitHub Actions**
3. Save (no `DASHBOARD_DEPLOY_TOKEN` needed)
4. Push this workflow (or **Actions → Deploy dashboard → Run workflow**)

You can delete the unused public `ESP32C3_MotionTracking_Dashboard` repo if you
created it earlier, and remove the old `DASHBOARD_DEPLOY_TOKEN` secret.

## Trigger a deploy

- Push changes under `web/ble_plotter/` to `main`, or
- **Actions → Deploy dashboard → Run workflow**

Firmware-only commits do not run this workflow. Pages is only the static
host under `web/ble_plotter/`.

## RowPod service worker vs IMU lab

`sw.js` is cache-first (`caches.match`, then network). Cache name
`rowpod-1.5.6` must stay in lockstep with `version.js`, `index.html?v=`, and
`rowpod.js` `register("./sw.js?v=1.5.6")`. `ASSETS` is the install-time
file list; a new RowPod module that is missing there stays stale on an
installed PWA until the cache name changes.

The IMU lab has **no** service worker. Lab cache-bust is the `?v=16.13`
query on `lab.html` / `styles.css` / `app.js`. Shared files
(`ble_client.js`, `pod_registry.js`) sit in the RowPod `ASSETS` list, and
`pod_registry.js` imports `ble_client.js?v=16.13`. Do not mix lab-only
modules (`hyrox.js`, `csv_log.js`, mag-cal) into `ASSETS`.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Workflow blocked / Pages permission | Settings → Pages → Source must be **GitHub Actions** |
| 404 after green deploy | Wait 1–2 min; open the URL with `/?v=1.5.6` |
| Environment approval wait | Settings → Environments → `github-pages` → remove required reviewers if you added any |
| Web Bluetooth fails | Must use the `https://…github.io/…` URL (or localhost), not `file://` |
| Phone still shows an old RowPod header | Hard-refresh; delete the old PWA and re-add. Cache name must be `rowpod-1.5.6` |
| New RowPod JS file never loads in the installed PWA | Add it to `sw.js` `ASSETS` and bump the cache name with `version.js` |
| Pages still old after a firmware push | Workflow only runs on `web/ble_plotter/**` (or manual dispatch) |

## Local fallback

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/?v=1.5.6`. IMU lab: `http://localhost:8080/lab.html?v=16.13`.
