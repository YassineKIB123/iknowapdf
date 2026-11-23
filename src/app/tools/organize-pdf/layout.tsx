import { toolMetadata } from "@/lib/seo/tool-metadata";

export const metadata = toolMetadata({
  path: "/tools/organize-pdf",
  title: "Organize PDF Pages – Reorder, Delete, Extract Free",
  description:
    "Drag PDF pages into a new order, delete pages you don't need, or extract selected pages into a new PDF. Free, private, runs in your browser.",
});

export default function OrganizePdfLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
