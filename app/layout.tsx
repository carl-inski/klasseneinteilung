import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Klasseneinteilung Jgst. 5",
  description:
    "Klasseneinteilung mit anonymisierter Verarbeitung: Excel hochladen, Kriterien gewichten, fertige Einteilung exportieren.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
