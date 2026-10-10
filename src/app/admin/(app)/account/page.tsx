import { requireUser } from "@/lib/auth";
import ActionForm, { inputCls, labelCls } from "@/components/admin/ActionForm";
import { changePasswordAction } from "@/app/admin/actions";

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="max-w-md">
      <h1 className="font-display text-3xl font-extrabold">My account</h1>
      <p className="mt-1 text-muted">{user.name}, {user.email}</p>
      <h2 className="mt-8 font-display text-xl font-semibold">Change password</h2>
      <ActionForm action={changePasswordAction} submitLabel="Change password" resetOnSuccess className="mt-3 grid gap-3 rounded-2xl border border-line bg-white p-5">
        <label className={labelCls}>Current password<input type="password" name="current" autoComplete="current-password" className={inputCls} required /></label>
        <label className={labelCls}>New password (8+ characters)<input type="password" name="next" autoComplete="new-password" minLength={8} className={inputCls} required /></label>
        <label className={labelCls}>New password again<input type="password" name="confirm" autoComplete="new-password" minLength={8} className={inputCls} required /></label>
      </ActionForm>
    </div>
  );
}
