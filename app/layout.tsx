import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Klasseneinteilung",
  description:
    "Klassen fair einteilen: Excel hochladen, Namen per KI abgleichen, Kriterien gewichten, fertige Einteilung exportieren — komplett anonymisiert.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
