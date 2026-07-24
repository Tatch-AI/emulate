import { pageMetadata } from "@/lib/page-metadata";

export const metadata = pageMetadata("knock");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
