import webpush from "web-push";

// Genera un par de claves VAPID para los avisos push (RF18). Se copian a las variables
// de entorno (en Netlify y en .env). Cambiarlas obliga a Caro a activar los avisos otra vez.
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
