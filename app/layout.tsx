import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LendLoop - Borrow what you need. Lend what you don't.", template: "%s | LendLoop" },
  description: "LendLoop is a neighborhood tool-sharing app: list tools you can lend and borrow the ones you need.",
};

export const viewport: Viewport = { themeColor: "#047857" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <ClerkProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
