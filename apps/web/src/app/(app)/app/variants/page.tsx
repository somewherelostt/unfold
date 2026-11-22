import { redirect } from "next/navigation";

/** The grid of versions is now a drawer in the editor; old links land on the home screen. */
export default function VariantsPage() {
  redirect("/app");
}
