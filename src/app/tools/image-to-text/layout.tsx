import { toolMetadata } from "@/lib/seo/tool-metadata";

export const metadata = toolMetadata({
  path: "/tools/image-to-text",
  title: "Image to Text (OCR) – Extract Text from Image Free",
  description:
    "Extract text from images, screenshots and scanned PDFs with free OCR. 10 languages, copy or save as .txt. Runs in your browser, nothing is uploaded.",
});

export default function ImageToTextLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
