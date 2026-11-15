// BUG-093: 従業員番号を、ユーザー一覧(/api/users)の氏名にする。引けない時(退職者・未登録など)は従業員番号のまま出す
export function displayUserName(
  users: ReadonlyArray<{ employeeNumber?: string | null; name?: string | null }>,
  employeeNumber: string | null | undefined,
): string {
  if (!employeeNumber) return "";
  return users.find((u) => u.employeeNumber === employeeNumber)?.name || employeeNumber;
}
