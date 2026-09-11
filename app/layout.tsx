import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Anota Aí · Governança de reuniões',
  referrer: 'no-referrer',
  description:
    'Planeje reuniões, registre decisões e acompanhe o que precisa acontecer.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
