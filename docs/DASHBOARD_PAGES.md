# Dashboard on GitHub Pages (same private repo)

With **GitHub Pro**, Pages can publish from this private repository. Only the
static files under `web/ble_plotter/` are deployed; firmware source stays in
`main` and is not the Pages artifact.

## URL

RowPod 1.5.6 (portrait oar arc + crew sync) is the site root:

`https://mhyeung.github.io/ESP32C3_MotionTracking_Gadget/?v=1.5.6`

IMU lab (plots, orientation, HYROX, session CSV, battery):

`https://mhyeung.github.io/ESP32C3_MotionTracking_Gadget/lab.html?v=16.13`

Old `rowpod.html` bookmarks redirect to `index.html`. Chrome or Edge.
Hard-refresh if scripts look stale. Installed PWAs must be deleted and
re-added when the cache name changes (`rowpod-1.5.6`).

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
| 404 after green deploy | Wait 1–2 min; open the URL with `/?v=1.5.6` |
| Environment approval wait | Settings → Environments → `github-pages` → remove required reviewers if you added any |
| Web Bluetooth fails | Must use the `https://…github.io/…` URL (or localhost), not `file://` |
| Phone still shows HYROX / plots at `/` | Hard-refresh; delete the old PWA and re-add. Cache name must be `rowpod-1.5.6` |
| Reconnect does nothing / asks for the chooser | Enable `chrome://flags/#enable-web-bluetooth-new-permissions-backend`, relaunch Chrome, then **Add pod** once per oar |
| Second pod connects but has no motion / first pod says **stale stream** | Reload, then **Reconnect pods**. The host pauses the live CCCD while the next pod subscribes. **Forget** on the lab card drops a permission so that pod is skipped until **Add pod** |
| Status names a pod asleep | Wake it (hold GPIO0 ~2 s, USB unplugged) and tap **Reconnect pods**. Auto-reconnect waits 4 s for an advertisement only when no pod is already live |

## Local fallback

```sh
cd web/ble_plotter
python -m http.server 8080
```

Open `http://localhost:8080/?v=1.5.6`. IMU lab: `http://localhost:8080/lab.html?v=16.13`.
