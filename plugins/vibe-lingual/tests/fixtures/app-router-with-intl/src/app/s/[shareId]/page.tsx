import { getTranslations } from 'next-intl/server';

export default async function SharePage() {
  const t = await getTranslations('share');
  return <h1>{t('notFound')}</h1>;
}
