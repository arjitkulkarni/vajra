import { AuthScreen } from "@/components/auth/AuthScreen";

/** The landing page is the front door: sign in, or request access. */
export default function Landing() {
  return <AuthScreen initial="login" />;
}
