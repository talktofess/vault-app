import { router } from "expo-router";
import { Button, Muted, Screen, Title } from "../../src/ui/components";

// The in-app camera captures straight to ciphertext using native APIs that
// don't exist on the web. On web this route is a friendly placeholder; the tab
// itself is hidden in (vault)/_layout.tsx for web. Use "Import" on the Media
// tab to add photos/videos from this computer instead.
export default function CameraWeb() {
  return (
    <Screen>
      <Title>Camera is mobile-only</Title>
      <Muted>
        Capturing a photo directly into the vault uses your phone&apos;s camera and
        isn&apos;t available in the web version. On a computer, use Import on the Media
        tab to add a photo or video from this device — it&apos;s encrypted the same way.
      </Muted>
      <Button label="Go to Media" onPress={() => router.replace("/(vault)/media")} />
    </Screen>
  );
}
