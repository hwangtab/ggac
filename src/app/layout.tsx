// 루트 레이아웃: Next.js가 요구하는 최소 루트 세그먼트.
// 실제 <html>/<body>와 모든 프로바이더는 app/[locale]/layout.tsx에 있다.
import './globals.css'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children
}
