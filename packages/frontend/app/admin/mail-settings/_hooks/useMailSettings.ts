"use client";

import { useState, useEffect } from "react";
import {
  MailTemplateSetting,
  UserProfile,
  AssetFileType,
  UploadStatus,
} from "../_types";
import { SystemSettings } from "../../company-settings/_types";
import { apiFetch } from "../../../_shared/hooks/use-api-fetch";
import { useConfirm } from "../../../_shared/hooks/use-confirm";

export function useMailSettings() {
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<MailTemplateSetting[]>([]);
  const [activeTab, setActiveTab] = useState<string>("");

  // 💡 見積書OTPダウンロードの詳細設定(会社・システム設定から移設)。実体は引き続き
  // company-settings側のKV(config)に保存されているため、既存の/api/company-settingsを
  // そのまま読み書きする(全項目を保持したオブジェクトとして取得し、OTP関連フィールドだけを
  // 本画面で編集・保存する。他のフィールドを巻き込んで初期化してしまわないため)。
  const [otpSettings, setOtpSettings] = useState<SystemSettings | null>(null);
  const [otpSettingsLoading, setOtpSettingsLoading] = useState(true);
  const [otpSettingsSubmitting, setOtpSettingsSubmitting] = useState(false);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 送信テスト用・モーダル開閉ステート
  const [testToEmail, setTestToEmail] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);
  const [selectedR2Path, setSelectedR2Path] = useState("");
  const [isR2ModalOpen, setIsR2ModalOpen] = useState(false);
  const [r2ModalInitialPrefix, setR2ModalInitialPrefix] = useState("");

  // 帳票Excelテンプレートアップロード用ステート(選択中の帳票1件分のみ、AssetFileTypeとは独立管理)
  const [reportTemplateUploading, setReportTemplateUploading] = useState(false);
  const [reportTemplateStatus, setReportTemplateStatus] =
    useState<UploadStatus | null>(null);

  // セキュリティ権限ステート
  const [hasMenuAccess, setHasMenuAccess] = useState(false);
  const [canRead, setCanRead] = useState(false);
  const [canWrite, setCanWrite] = useState(false);

  // ファイルアップロード用ステート
  const [uploadingType, setUploadingType] = useState<AssetFileType | null>(
    null,
  );
  const [uploadStatuses, setUploadStatuses] = useState<{
    [key in AssetFileType]: UploadStatus | null;
  }>({
    font: null,
    logo: null,
    seal: null,
  });

  useEffect(() => {
    const initializePage = async () => {
      try {
        const [userProfile, currentTemplates, currentCompanySettings] =
          await Promise.all([
            apiFetch<UserProfile>("/api/auth/profile", {
              defaultErrorMessage: "必要な設定データの同期に失敗しました",
            }),
            apiFetch<MailTemplateSetting[]>("/api/mail-settings", {
              defaultErrorMessage: "必要な設定データの同期に失敗しました",
            }),
            apiFetch<SystemSettings>("/api/company-settings", {
              defaultErrorMessage: "OTPダウンロード設定の取得に失敗しました",
            }),
          ]);

        setTemplates(currentTemplates);
        if (currentTemplates.length > 0) {
          setActiveTab(currentTemplates[0].id);
        }
        setOtpSettings(currentCompanySettings);

        // 既存の厳格な権限判定判定ロジックを適用
        if (userProfile.roleId === "admin") {
          setHasMenuAccess(true);
          setCanRead(true);
          setCanWrite(true);
        } else {
          const userPerms = userProfile.permissions || [];
          setHasMenuAccess(userPerms.includes("admin_mail_settings:menu"));
          setCanRead(userPerms.includes("admin_mail_settings:read"));
          setCanWrite(
            userPerms.includes("admin_mail_settings:create") ||
              userPerms.includes("admin_mail_settings:update"),
          );
        }
      } catch (err) {
        console.error("初期化エラー:", err);
        setError("システム初期化中にエラーが発生しました");
      } finally {
        setOtpSettingsLoading(false);
        setLoading(false);
      }
    };

    void initializePage();
  }, []);

  const currentTemplate = templates.find((t) => t.id === activeTab);

  // OTPダウンロード詳細設定の編集(ローカルStateのみ更新。保存は下のhandleSaveOtpSettings)
  const handleOtpFieldChange = <K extends keyof SystemSettings>(
    field: K,
    value: SystemSettings[K],
  ) => {
    setOtpSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  // OTPダウンロード詳細設定の保存(実体はcompany-settings側のKV。他フィールドを
  // 巻き込まないよう、取得時点のオブジェクト全体に編集後の値を反映して丸ごとPUTする)
  const handleSaveOtpSettings = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!canWrite || !otpSettings) {
      setError("あなたにはこの設定を変更する権限がありません");
      return;
    }

    setError("");
    setMessage("");
    setOtpSettingsSubmitting(true);

    try {
      await apiFetch("/api/company-settings", {
        method: "PUT",
        json: otpSettings,
        defaultErrorMessage: "OTPダウンロード設定の更新に失敗しました",
      });

      setMessage("OTPダウンロードの詳細設定を保存しました");
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setOtpSettingsSubmitting(false);
    }
  };

  const handleFieldChange = (
    field: keyof MailTemplateSetting,
    value: string,
  ) => {
    if (!activeTab) return;
    setTemplates((prev) =>
      prev.map((t) => (t.id === activeTab ? { ...t, [field]: value } : t)),
    );
  };

  // テンプレート保存更新処理
  const handleSaveSettings = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!canWrite || !currentTemplate) {
      setError("あなたにはこの設定を変更する権限がありません");
      return;
    }

    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      await apiFetch("/api/mail-settings", {
        method: "PUT",
        json: currentTemplate,
        defaultErrorMessage: "更新に失敗しました",
      });

      setMessage(
        `「${currentTemplate.name}」の配信フォーマットを上書き保存しました`,
      );
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 実機テストメールの配送要求ハンドラー
  const handleTestSend = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!currentTemplate) return;
    if (!testToEmail.trim()) {
      setError("テストメールの送信先(To)を入力してください");
      return;
    }

    setError("");
    setMessage("");
    setTestingEmail(true);

    try {
      const data = await apiFetch<{ message: string }>(
        "/api/mail-settings/test-email",
        {
          method: "POST",
          json: {
            id: currentTemplate.id,
            testToEmail: testToEmail.trim(),
            attachedR2Path: selectedR2Path.trim() || undefined,
          },
          defaultErrorMessage: "テスト送信に失敗しました",
        },
      );

      setMessage(data.message);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setTestingEmail(false);
    }
  };

  // 共通アセットファイルアップロードロジック
  const handleFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    fileType: AssetFileType,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // BUG-037: 形式の誤りは alert ではなく、アップロード欄の結果表示で伝える
    if (fileType !== "font" && file.type !== "image/png") {
      setUploadStatuses((prev) => ({
        ...prev,
        [fileType]: {
          message:
            "❌ 会社ロゴおよび社印は、背景透過処理などが適用可能な PNG 形式 (.png) のみアップロード可能です",
          isError: true,
        },
      }));
      e.target.value = "";
      return;
    }

    setUploadingType(fileType);
    setUploadStatuses((prev) => ({ ...prev, [fileType]: null }));

    const formData = new FormData();
    formData.append("fileType", fileType);
    formData.append("file", file);

    try {
      await apiFetch("/api/mail-settings/upload-file", {
        method: "POST",
        body: formData,
        defaultErrorMessage: "アップロードに失敗しました",
      });

      const label =
        fileType === "font"
          ? "フォントファイル"
          : fileType === "logo"
            ? "会社ロゴ"
            : "社印";
      setUploadStatuses((prev) => ({
        ...prev,
        [fileType]: {
          message: `✅ ${label}の固定パスへの配置が正常に完了しました！`,
          isError: false,
        },
      }));
    } catch (err: any) {
      setUploadStatuses((prev) => ({
        ...prev,
        [fileType]: { message: `❌ エラー: ${err.message}`, isError: true },
      }));
    } finally {
      setUploadingType(null);
      e.target.value = "";
    }
  };

  // 帳票Excelテンプレートのアップロード(選択中の帳票=activeTabに紐づける固定パス上書き方式)
  const handleReportTemplateUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file || !activeTab) return;

    // BUG-037: 形式の誤りは alert ではなく、アップロード欄の結果表示で伝える
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      setReportTemplateStatus({
        message:
          "❌ 帳票テンプレートは Excel形式 (.xlsx) のみアップロード可能です",
        isError: true,
      });
      e.target.value = "";
      return;
    }

    setReportTemplateUploading(true);
    setReportTemplateStatus(null);

    const formData = new FormData();
    formData.append("fileType", "report_template");
    formData.append("documentTypeId", activeTab);
    formData.append("file", file);

    try {
      const result = await apiFetch<{ success: boolean; path: string }>(
        "/api/mail-settings/upload-file",
        {
          method: "POST",
          body: formData,
          defaultErrorMessage: "アップロードに失敗しました",
        },
      );

      setTemplates((prev) =>
        prev.map((t) =>
          t.id === activeTab
            ? {
                ...t,
                reportTemplatePath: result.path,
                reportLayoutStatus: "PENDING",
                reportLayoutError: null,
              }
            : t,
        ),
      );
      setReportTemplateStatus({
        message: `✅ 帳票Excelテンプレートの固定パスへの配置が正常に完了しました！(コンパイルは最大1分程度で自動完了します)`,
        isError: false,
      });
    } catch (err) {
      setReportTemplateStatus({
        message: `❌ エラー: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      });
    } finally {
      setReportTemplateUploading(false);
      e.target.value = "";
    }
  };

  // 帳票Excelテンプレートの削除(既定のpdf-lib描画へフォールバックさせる)
  const handleReportTemplateDelete = async () => {
    if (!activeTab || !currentTemplate?.reportTemplatePath) return;
    if (
      !(await confirm(
        `「${currentTemplate.name}」の帳票Excelテンプレートを削除します。削除後は既定のPDFレイアウトで生成されます。よろしいですか？`,
      ))
    ) {
      return;
    }

    setReportTemplateUploading(true);
    setReportTemplateStatus(null);

    try {
      await apiFetch(`/api/mail-settings/report-template/${activeTab}`, {
        method: "DELETE",
        defaultErrorMessage: "削除に失敗しました",
      });

      setTemplates((prev) =>
        prev.map((t) =>
          t.id === activeTab
            ? {
                ...t,
                reportTemplatePath: null,
                reportLayoutStatus: null,
                reportLayoutError: null,
              }
            : t,
        ),
      );
      setReportTemplateStatus({
        message: "✅ 帳票Excelテンプレートを削除しました",
        isError: false,
      });
    } catch (err) {
      setReportTemplateStatus({
        message: `❌ エラー: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      });
    } finally {
      setReportTemplateUploading(false);
    }
  };

  // R2エクスプローラーを「テスト添付選択」用に開く(従来通りルート直下から)
  const openR2ModalForAttachment = () => {
    setR2ModalInitialPrefix("");
    setIsR2ModalOpen(true);
  };

  // R2エクスプローラーを「帳票テンプレート保存確認」用に開く(report_templates/直下から)
  const openR2ModalForReportTemplates = () => {
    setR2ModalInitialPrefix("report_templates/");
    setIsR2ModalOpen(true);
  };

  return {
    templates,
    activeTab,
    setActiveTab,
    loading,
    submitting,
    message,
    setMessage,
    error,
    setError,
    otpSettings,
    otpSettingsLoading,
    otpSettingsSubmitting,
    handleOtpFieldChange,
    handleSaveOtpSettings,
    testToEmail,
    setTestToEmail,
    testingEmail,
    selectedR2Path,
    setSelectedR2Path,
    isR2ModalOpen,
    setIsR2ModalOpen,
    r2ModalInitialPrefix,
    hasMenuAccess,
    canRead,
    canWrite,
    uploadingType,
    uploadStatuses,
    currentTemplate,
    handleFieldChange,
    handleSaveSettings,
    handleTestSend,
    handleFileUpload,
    reportTemplateUploading,
    reportTemplateStatus,
    setReportTemplateStatus,
    handleReportTemplateUpload,
    handleReportTemplateDelete,
    openR2ModalForAttachment,
    openR2ModalForReportTemplates,
  };
}
