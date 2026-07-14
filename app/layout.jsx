import "./globals.css";

export const metadata = {
  title: "בקרת בקשות ייצור",
  description: "מעקב, בקרה ותיעדוף עבודות ייצור במדור",
};

export const viewport = {
  themeColor: "#101b2d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
