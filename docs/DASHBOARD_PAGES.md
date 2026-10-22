# Dashboard on GitHub Pages (same private repo)

With **GitHub Pro**, Pages can publish from this private repository. Only the
static files under `web/ble_plotter/` are deployed; firmware source stays in
`main` and is not the Pages artifact.

## URL

RowPod 1.4.4 (portrait oar arc + crew sync) is the site root:

`https://mhyeung.github.io/ESP32C3_MotionTracking_Gadget/?v=1.4.4`

IMU lab (plots, orientation, HYROX, session CSV, battery):

`https://mhyeung.github.io/ESP32C3_MotionTracking_Gadget/lab.html?v=16.9`

Old `rowpod.html` bookmarks redirect to `index.html`. Chrome or Edge.
Hard-refresh if scripts look stale.

> The site URL is still **public** (anyone with the link can open the UI).
> Pro does not hide the hosted page; it only lets you publish from a private repo.
> BLE still needs a nearby pod and a browser gesture.

## One-time setup

1. Open  
   `https://github.com/MHYeung/ESP32C3_MotionTracking_Gadget/settings/pages`
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
| 404 after green deploy | Wait 1–2 min; open the URL with `/?v=1.4.4` |
| Environment approval wait | Settings → Environments → `github-pages` → remove required reviewers if you added any |
| Web Bluetooth fails | Must use the `https://…github.io/…` URL (or localhost), not `file://` |
| Phone still shows HYROX / plots at `/` | Hard-refresh; delete the old PWA and re-add. Cache name must be `rowpod-1.4.4` |

## Local fallback

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/?v=1.4.4`. IMU lab: `http://localhost:8080/lab.html?v=16.9`.
