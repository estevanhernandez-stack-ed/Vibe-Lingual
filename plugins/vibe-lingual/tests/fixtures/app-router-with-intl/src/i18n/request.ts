import { getRequestConfig } from 'next-intl/server';

const AVAILABLE = ['en', 'es', 'ja'];

export default getRequestConfig(async () => {
  const wanted = 'en';
  return {
    locale: wanted,
    messages: (await import(`../../messages/${wanted}.json`)).default,
  };
});
