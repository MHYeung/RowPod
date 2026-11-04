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

- Push changes under `web/ble_plotter/`, or
- **Actions → Deploy dashboard → Run workflow**

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Workflow blocked / Pages permission | Settings → Pages → Source must be **GitHub Actions** |
| 404 after green deploy | Wait 1–2 min; open the URL with `/?v=1.5.6` |
| Environment approval wait | Settings → Environments → `github-pages` → remove required reviewers if you added any |
| Web Bluetooth fails | Must use the `https://…github.io/…` URL (or localhost), not `file://` |
| Phone still shows an old RowPod header | Hard-refresh; delete the old PWA and re-add. Cache name must be `rowpod-1.5.6` |

## Local fallback

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/?v=1.5.6`. IMU lab: `http://localhost:8080/lab.html?v=16.13`.
