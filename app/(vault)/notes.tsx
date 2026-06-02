// Retired: unified into the Library ("Vault"). Bounces to it.
import { Redirect } from "expo-router";

export default function Notes() {
  return <Redirect href="/(vault)/library" />;
}
