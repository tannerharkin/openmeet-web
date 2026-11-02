import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function Unsupported() {
  return (
    <Card className="mt-6 border-destructive/50">
      <CardContent className="flex items-center gap-4" role="alert">
        <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden />
        <div>
          <p className="font-medium">WebHID is not available here</p>
          <p className="text-sm text-muted-foreground">Use Chrome or Edge, opened from a file:// or https:// address.</p>
        </div>
      </CardContent>
    </Card>
  );
}
