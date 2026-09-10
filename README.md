# S&S Dispatch Assistant - v1.2

## Ban sua nay lam gi?

- Loc theo ngay giao nhan, mui gio America/Toronto. Task assign cho ngay mai khong lam driver bi AT RISK hom nay.
- Pickup 11:00 -> han Start 10:00. Tu 10:00 chua Start dung pickup task thi canh bao NOT STARTED; day KHONG phai ket luan pickup da tre.
- Tach LATE thuc te, ETA RISK, SCHEDULED, UNKNOWN, NO TASKS va DONE. Loi API/ETA/GPS khong duoc bien thanh ON TIME.
- Trang Drivers chi hien ten, presence, movement va status. Trang Overview/Orders hien cac ngoai le can xu ly.
- Giao dien phone, them icon ra Home Screen, web push, nut gui thong bao thu.
- Onfleet va Google Sheets chi doc. Khong tu Start, assign, doi lich, tao task hay sua Sheet.

## Tinh trang giao ban

Day la SOURCE CODE da test cuc bo, CHUA duoc upload/deploy vao Vercel cua ban.
Phone push CHUA duoc kich hoat. Google Sheet CHUA duoc cap credential trong app.
Van can doi chieu du lieu Onfleet that va test thong bao tren phone truoc khi dung van hanh.
Tests: `npm test`; bao cao chi tiet o TEST-REPORT.md.

## Buoc dau tien: cap nhat code va bao ve app

1. Giai nen ZIP. Upload TOAN BO file va folder ben trong len repo ss-dispatch-assistant, gom `api/`, `lib/`, `ops/`, `icons/`, `tests/`, `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `package.json`, `vercel.json`. Khong upload ca ZIP; khong chi upload index.html.
2. Vercel -> project -> Settings -> Environment Variables: giu nguyen `ONFLEET_API_KEY`. Them `APP_ACCESS_PASSWORD`, Value la mat khau ngau nhien it nhat 16 ky tu. Khong dung API key lam mat khau. Khong dua secrets len GitHub/chat.
3. Commit changes; doi Ready. Neu vua thay environment variable sau build, Redeploy. Mo web va dang nhap bang APP_ACCESS_PASSWORD.

Config mac dinh KHONG bat cron hay mua them dich vu. File `vercel.json` chay build va chi public frontend; folder lib/ops/tests khong duoc phuc vu nhu file tinh. Neu project override Build Command/Output Directory trong Dashboard, dat build la `npm run build`, output la `public`, Framework Preset la Other.

## Phone alerts: can cai tren server truoc

Can 3 thanh phan: bo kiem tra theo phut + noi luu trang thai + web push.
Chi bam Allow tren phone KHONG du de monitor khi app dong.

### Luu trang thai rieng

Dung mot Supabase project RIENG cho dispatch. Khong chay vao FXA hay database khac.
Mo SQL Editor, dan `ops/setup.sql`, Run. Script nay tao 3 bang server-only va khoa monitor; khong sua business tables co san.
Them vao Vercel:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (hoac legacy `SUPABASE_SERVICE_ROLE_KEY`)

Khong dung publishable/anon key cho server nay. Data API can duoc enable. Script thu hoi quyen anon/authenticated va bat RLS. Chi service role doc/ghi.
SQL chua duoc chay/test tren Supabase cua ban trong phien giao ban nay.

### Khoa web push va bo kiem tra

Tren may co Node.js, chay `node ops/generate-secrets.mjs` MOT LAN. Ket qua la bi mat: khong upload, khong gui vao chat. Giu khoa VAPID on dinh, doi khoa se can dang ky phone lai.
Them cac ten sau vao SERVER Environment Variables cua Vercel:

- `CRON_SECRET`: it nhat 32 ky tu ngau nhien.
- `VAPID_PUBLIC_KEY` va `VAPID_PRIVATE_KEY`: cap khoa vua tao.
- `VAPID_SUBJECT`: `mailto:` kem email cong viec that.

Khong ghi de APP_ACCESS_PASSWORD dang dung neu khong co y doi mat khau.

Sau khi DB/keys hoan tat va da xac nhan goi hosting phu hop, thay `vercel.json` bang NOI DUNG `ops/vercel-cron.example.json`, commit de bat `/api/monitor` moi phut.
Vercel Hobby chi cho cron moi ngay; monitor moi phut can Pro/Enterprise. Commercial usage khong thuoc Hobby. File mau khong tu dang ky hay nang cap goi. Vercel tu truyen CRON_SECRET bang Authorization Bearer.
Giup viec test that: xem tab Notifications -> Background checker. Phai hien recent successful check; heartbeat >150 giay la chua duoc xac nhan. API/cron/DB loi khong co healthy fallback.

### Dang ky phone

- iPhone iOS 16.4+: Safari -> Share -> Add to Home Screen -> mo icon vua them.
- Android ho tro web push: mo app trong Chrome -> Install/Add to Home screen.
- Dang nhap -> Alerts -> Enable phone alerts -> Allow -> Send a test notification.
- Khoa man hinh, xac nhan co nhan thong bao; sau do tao tinh huong test trong Onfleet TEST account, khong fake-start task khach that.
- `accepted` chi co nghia push service chap nhan, KHONG dam bao phone da hien. Focus, quyen thong bao, mang va he dieu hanh co the tri hoan/chan.
- Thong bao mac dinh khong hien ten driver/dia chi/so dien thoai khach tren lock screen. Bam thong bao de xem app.
- Dang ky phone het han sau 30 ngay; bam Enable lai de gia han. Dang xuat thu huy dang ky phone; cung co nut Turn off this phone.

## Google Sheet va don thieu

App khong thua huong quyen Google Drive cua ChatGPT. Can ket noi server rieng:

1. Tao Google service account; bat Google Sheets API.
2. Share dung spreadsheet cho email service account voi quyen Viewer. Khong public spreadsheet va khong bat domain-wide delegation.
3. Them `GOOGLE_SHEET_ID` va `GOOGLE_SERVICE_ACCOUNT_JSON` vao Vercel. JSON private key chi luu server.
4. Mac dinh doc tab `<Month> <Year>` theo ngay dang chon, vi du September 2026. `GOOGLE_SHEET_TAB` chi dung khi can override ten tab.

Can co cac cot Order Date, ONFLEET ID, Pickup Time, Client Delivery Time; Providor/Provider/Vendor la nhan hien thi. workerName KHONG duoc hieu la driver vi Sheet co the dat ten nha hang o do.
Chi match exact full Onfleet ID hoac shortId. ID trong/memo, nhieu dong chung ID, ngay/lich xung dot -> NEEDS REVIEW, khong khang dinh MISSING va khong tu tao trung task.
NOT FOUND la missing CANDIDATE trong du lieu da doc, can xac minh. Ban nay khong tu doan fuzzy address matching.
Neu ID tro vao delivery, Start cutoff chi dung Sheet pickup khi co dung MOT pickup dependency duoc link. Neu khong, bao can map pickup. Khong ap dung pickup cutoff cho dropoff.
Ban ghi completed duoc lay theo completion-time window tu ngay chon -1 den +8 ngay (khong vuot hien tai); khong phai archive day du neu task hoan thanh rat muon/bi xoa. Do do NOT FOUND van la candidate, khong phai ket luan definitive.

## Dinh nghia quan trong

- Online: onDuty VA last seen moi <=3 phut; onDuty rieng khong chung minh driver dang di.
- Moving: task active va GPS moi thay doi >=100m trong 30 giay den 3 phut.
- Not moving: GPS moi lien tuc it nhat 10 phut, it nhat 6 mau, khoang cach <=75m; bo qua khi trong 150m cua diem task. Chi la canh bao can kiem tra, khong quy loi cho driver.
- GPS unknown: thieu/mat du lieu moi. Khong duoc hieu la dung yen.
- Movement can lich su samples tu monitor server. Mo web khong tu tao du lich su ben vung.
- Driver Start mot task KHAC khong dap ung cutoff cua pickup nay. Khi stacking/nhieu pickup co cutoff chong nhau, dispatcher can xem lai workflow; app khong tu dong Start tat ca.
- Future: SCHEDULED, khong phai ON TIME da duoc kiem chung. Khi cutoff thuc su den (ke ca 23:30 cho pickup ngay mai 00:30), monitor co the gui NOT STARTED.
- Mo ngay cu: ket qua giao nhan theo ngay do, presence la hien tai; khong gia lap GPS lich su.
- Cung mot canh bao: gui lan dau, nhac lai o +15 va +30 phut; leo thang severity co the tao tin moi. Huy canh bao sau khi du lieu moi xac nhan. Moi device co receipt; du lieu khong day du khong tu dong xoa canh bao.
- Co TTL push 5 phut; khong de canh bao cu cho nhieu ngay. Khong cam ket exactly-once/real-time: crash giua gui va luu receipt co the gui lai.

## Sources / implementation references

- Onfleet tasks and timestamp filtering: https://docs.onfleet.com/reference/list-tasks
- Onfleet task state/ETA: https://docs.onfleet.com/reference/get-single-task
- Onfleet workers: https://docs.onfleet.com/reference/list-workers
- Apple web push: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- Vercel cron limits: https://vercel.com/docs/cron-jobs/usage-and-pricing
- Vercel commercial plan: https://vercel.com/docs/limits/fair-use-guidelines
- Supabase API security: https://supabase.com/docs/guides/api/securing-your-api
- Google service account auth: https://developers.google.com/identity/protocols/oauth2/service-account
- web-push library: https://github.com/web-push-libs/web-push
