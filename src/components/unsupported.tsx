import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function Unsupported({ reason = "unsupported" }: { reason?: "unsupported" | "framed" }) {
  const framed = reason === "framed";
  return (
    <Card className="mt-6 border-destructive/50">
      <CardContent className="flex items-center gap-4" role="alert">
        <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden />
        <div>
          <p className="font-medium">{framed ? "This page is shown inside another page" : "WebHID is not available here"}</p>
          <p className="text-sm text-muted-foreground">
            {framed ? "For your safety it does not talk to the dongle in a frame. Open this page directly in its own tab." : "Use Chrome or Edge, opened from a file:// or https:// address."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
