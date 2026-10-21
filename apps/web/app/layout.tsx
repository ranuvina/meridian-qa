import './globals.css';

export const metadata = { title: 'Meridian', description: 'API usage platform' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
