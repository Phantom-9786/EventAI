import Link from '@/components/ui/app-link';
import { Compass } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function NotFound() {
  return (
    <div className="container flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <Compass className="h-7 w-7" />
      </span>
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The page you are looking for does not exist or has been moved.
      </p>
      <Link href="/" className={cn(buttonVariants())}>
        Back to home
      </Link>
    </div>
  );
}
