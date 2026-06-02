// Retired: media/notes/files are unified into the Library ("Vault"). This route
// stays only so old links/redirects resolve — it bounces to the Library.
import { Redirect } from "expo-router";

export default function Media() {
  return <Redirect href="/(vault)/library" />;
}
