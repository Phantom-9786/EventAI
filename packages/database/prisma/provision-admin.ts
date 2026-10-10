/**
 * One-time local administrator bootstrap. Run only after the intended account
 * exists, is active, and has verified its email. This script never creates an
 * account, accepts a password, or exposes an HTTP promotion endpoint.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Prisma, PrismaClient } from '@prisma/client';

async function main() {
  const prompt = createInterface({ input: stdin, output: stdout });
  const prisma = new PrismaClient();
  try {
    const email = (await prompt.question('Verified account email to provision: ')).trim().toLowerCase();
    if (!email || !email.includes('@')) throw new Error('Enter a valid account email.');
    const confirmation = await prompt.question('Type PROVISION FIRST ADMIN to continue: ');
    if (confirmation !== 'PROVISION FIRST ADMIN') throw new Error('Provisioning was not confirmed.');

    await prisma.$transaction(async (tx) => {
      if (await tx.user.count({ where: { role: 'ADMIN' } })) {
        throw new Error('An admin already exists; first-admin provisioning is closed.');
      }
      const target = await tx.user.findUnique({
        where: { email },
        select: { id: true, role: true, isActive: true, isEmailVerified: true },
      });
      if (!target || !target.isActive || !target.isEmailVerified) {
        throw new Error('The account must exist, be active, and have a verified email.');
      }
      await tx.user.update({ where: { id: target.id }, data: { role: 'ADMIN' } });
      await tx.auditLog.create({
        data: {
          userId: target.id,
          action: 'ADMIN_BOOTSTRAPPED',
          entity: 'USER',
          entityId: target.id,
          details: { method: 'local-one-time-bootstrap' },
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    console.log('First admin provisioned successfully.');
  } finally {
    prompt.close();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Provisioning failed.';
  console.error(message);
  process.exitCode = 1;
});
