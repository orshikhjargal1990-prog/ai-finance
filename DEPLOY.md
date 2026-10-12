# Render дээр байрлуулах

Энэ төсөл Express сервертэй тул Render-ийн **Web Service** хэлбэрээр ажиллана.

1. Төслийг GitHub-ийн **private** repository-д оруулна. `.env` файл Git-д орохгүйг шалгана.
2. Render → **New → Blueprint** сонгоод repository-г холбоно. Үндсэн хавтас дахь `render.yaml`-ийг ашиглана.
3. Render-ийн нууц хувьсагчийн дэлгэцэд `OPENAI_API_KEY`, `SITE_ACCESS_PASSWORD`-ийг оруулна. Сайтын нэвтрэх нэр `finance`; нууц үг нь `SITE_ACCESS_PASSWORD` утга байна.
4. Deploy дуусмагц `/api/health` хаяг `ok: true` буцааж байгааг шалгана. Дараа нь үндсэн хаягаар нэвтэрч чат болон войс үйлдлийг туршина.
5. Telegram ашиглах бол Render-ийн Environment-д `TELEGRAM_BOT_TOKEN` болон `TELEGRAM_WEBHOOK_SECRET` нэмээд, шинэ `https://<service>.onrender.com/api/telegram/webhook` хаягаар webhook-ийг бүртгэнэ.

Render `PORT`-ийг өөрөө өгнө. Санхүүгийн бүртгэл одоогоор тухайн браузерын `localStorage`-д хадгалагдана. Өөр төхөөрөмж дээр автоматаар харагдахгүй бөгөөд браузерын өгөгдлийг арилгавал бүртгэл устах эрсдэлтэй. Бүрэн олон хэрэглэгчтэй үйлчилгээ болгохын тулд серверийн хэрэглэгчийн бүртгэл, өгөгдлийн сан шаардлагатай.
