import { useState } from "react";
import { Link } from "react-router-dom";
import { APP_STORE_URL } from "@/lib/site";
import { Button } from "@/components/ui/button";
import { brandLogo as logo } from "@/lib/brand";
import { Menu, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";

const navLinks = [
  { label: "Demo", href: "/#demo", isAnchor: true },
  { label: "How it works", href: "/#how-it-works", isAnchor: true },
  { label: "For leaders", href: "/for-leaders", isAnchor: false },
  { label: "For coaches", href: "/for-coaches", isAnchor: false },
  { label: "Operating audit", href: "/operating-audit", isAnchor: false },
  { label: "Pricing", href: "/#pricing", isAnchor: true },
  { label: "FAQ", href: "/faq", isAnchor: false },
  { label: "Support", href: "/support", isAnchor: false },
  { label: "Privacy", href: "/privacy", isAnchor: false },
];

const Navbar = () => {
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed left-0 right-0 top-0 z-50 border-none pt-[calc(env(safe-area-inset-top,0px)+12px)] md:pt-0" style={{ background: 'var(--glass-bg)', backdropFilter: 'blur(16px)' }}>
      <div className="container mx-auto flex h-[84px] items-center justify-between px-4 pt-2 md:h-20 md:items-end md:pb-2 md:pt-0">
        <Link to="/" className="flex items-center md:items-end">
          <img src={logo} alt="Intentus" className="h-8 w-auto object-contain md:h-16" />
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-end gap-6 md:flex pb-0.5">
          {navLinks.map((link) =>
            link.isAnchor ? (
              <a key={link.href} href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                {link.label}
              </a>
            ) : (
              <Link key={link.href} to={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                {link.label}
              </Link>
            )
          )}
        </div>

        {/* Desktop CTA */}
        <div className="hidden items-end gap-3 pb-0.5 md:flex">
          <Button asChild variant="ghost" size="sm">
            <Link to="/auth">Log in</Link>
          </Button>
          <Button asChild variant="hero" size="sm">
            <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">Get the app</a>
          </Button>
        </div>

        {/* Mobile hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <Button asChild variant="ghost" size="sm" className="px-3 text-xs">
            <Link to="/auth">Log in</Link>
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-10 w-10">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-background p-0">
              <SheetTitle className="sr-only">Intentus navigation</SheetTitle>
              <SheetDescription className="sr-only">Explore Intentus, get support, or sign in to your account.</SheetDescription>
              <div className="flex flex-col h-full">
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border px-5 py-4">
                  <img src={logo} alt="Intentus" className="h-8 w-auto object-contain" />
                </div>

                {/* Links */}
                <nav className="flex flex-col gap-1 px-4 py-4">
                  {navLinks.map((link) => (
                    <SheetClose asChild key={link.href}>
                      {link.isAnchor ? (
                        <a
                          href={link.href}
                          className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          to={link.href}
                          className="rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                        >
                          {link.label}
                        </Link>
                      )}
                    </SheetClose>
                  ))}
                </nav>

                {/* CTA buttons */}
                <div className="mt-auto border-t border-border px-4 py-4 space-y-2">
                  <SheetClose asChild>
                    <Button asChild variant="hero" className="w-full justify-center">
                      <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">Get the app</a>
                    </Button>
                  </SheetClose>
                  <SheetClose asChild>
                    <Button asChild variant="ghost" className="w-full justify-center">
                      <Link to="/auth">Log in</Link>
                    </Button>
                  </SheetClose>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
