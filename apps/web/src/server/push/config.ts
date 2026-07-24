export type WebPushConfig = Readonly<{
  subject: string;
  publicKey: string;
  privateKey: string;
}>;

type Environment = Readonly<Record<string, string | undefined>>;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function validSubject(value: string): boolean {
  if (value.startsWith("mailto:")) {
    return /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && url.username === "" && url.password === "" && url.hash === ""
    );
  } catch {
    return false;
  }
}

export function webPushConfig(environment: Environment = process.env): WebPushConfig | null {
  const subject = environment.WEB_PUSH_VAPID_SUBJECT?.trim() ?? "";
  const publicKey = environment.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
  const privateKey = environment.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() ?? "";

  if (
    !validSubject(subject) ||
    !BASE64URL.test(publicKey) ||
    !BASE64URL.test(privateKey) ||
    publicKey.length < 80 ||
    publicKey.length > 120 ||
    privateKey.length < 40 ||
    privateKey.length > 80
  ) {
    return null;
  }

  return { subject, publicKey, privateKey };
}
