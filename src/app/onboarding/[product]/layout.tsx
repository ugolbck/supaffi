import { loadStepContext } from "./checks";

// A pass-through, on purpose. It resolves the product so an unknown slug
// redirects to /onboarding before any page under it renders, and nothing
// else: a layout is not re-rendered when only the child segment changes, so
// anything that has to follow the current step — the rail — belongs to the
// page instead.
export default async function ProductOnboardingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  await loadStepContext(product);
  return children;
}
