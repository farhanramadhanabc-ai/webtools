# ABC Membership Tools — Browser Only / No Login

Deploy ke Railway/Render/VPS.

## Railway agar browser profile persisten
1. Deploy repo ini.
2. Service → Volumes → Add Volume.
3. Mount path: `/data`
4. Redeploy.

Browser state/cache akan disimpan di `/data/abc-browser-profile`.

## Networking
Lihat log:
`ABC Membership Tools running on :XXXX`

Target port domain harus sama dengan angka itu.

## Penting
Tidak ada login wajib. Namun Instagram/TikTok/Facebook tetap bisa menampilkan login wall/challenge kepada browser server. Jika terjadi, tool akan menampilkan status blocked dan tidak mengarang data.
