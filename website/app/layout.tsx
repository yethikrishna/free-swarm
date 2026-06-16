import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FreeSwarm - AI Agent Orchestrator',
  description: 'Launch, monitor, and coordinate multiple AI agents from a single interface. Local-first, no cloud relay.',
  openGraph: {
    title: 'FreeSwarm - AI Agent Orchestrator',
    description: 'An army of AI agents at your fingertips',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100">
        {children}
      </body>
    </html>
  );
}
