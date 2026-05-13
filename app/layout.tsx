import type { Metadata } from "next";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Aton Member Dashboard",
  description:
    "BI self-service do assinante Aton — leads, campanhas, anúncios e qualificação em tempo real.",
};

// Script anti-FOUC injetado inline no <head>: lê localStorage como cache do
// último tema conhecido e seta data-theme ANTES do primeiro paint. O DB é
// source of truth — ThemeInitializer faz fetch silencioso depois pra
// confirmar/atualizar. Em iframe Uchat onde Safari pode bloquear
// third-party storage, o try/catch falha gracefully e o default "light"
// vale até o fetch da API responder (~200ms de "pisca" no pior caso).
const themeInitScript = `
(function(){
  try {
    var t = localStorage.getItem("aton-theme");
    if (t === "dark" || t === "light") {
      document.documentElement.setAttribute("data-theme", t);
      return;
    }
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", "light");
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} ${montserrat.variable} h-full antialiased`}
      // data-theme final é setado pelo script inline antes do paint;
      // o valor aqui é fallback no caso de JS estar desabilitado.
      data-theme="light"
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
