import { AcknowledgmentType } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/dictionary";

/**
 * The standard body text for each acknowledgment type. Snapshotted into
 * `EmployeeAcknowledgment.title` at generation time, so a later wording change
 * does not rewrite already-signed acknowledgments.
 */
export const ACKNOWLEDGMENT_BODY: Record<AcknowledgmentType, string> = {
  employment_terms:
    "أقر أنا الموظف الموقّع أدناه بأنني اطّلعت على شروط التعاقد الخاصة بوظيفتي لدى شركة Afro Egypt، " +
    "وعلى لائحة العمل الداخلية ومواعيد الحضور والانصراف وقواعد احتساب الأجر والخصومات، وأوافق عليها وألتزم بها.",
  custody_receipt:
    "أقر أنا الموظف الموقّع أدناه باستلامي العهدة المخصّصة لي لأداء عملي، وأتعهّد بالمحافظة عليها " +
    "واستخدامها في أغراض العمل فقط، وردّها بحالة سليمة عند انتهاء الخدمة أو عند طلب الشركة.",
  confidentiality:
    "أتعهّد أنا الموظف الموقّع أدناه بالحفاظ على سرية كل المعلومات والبيانات التي أطّلع عليها بحكم عملي، " +
    "وعدم إفشائها أو استخدامها خارج نطاق العمل، أثناء الخدمة وبعد انتهائها.",
  code_of_conduct:
    "أقر أنا الموظف الموقّع أدناه بأنني اطّلعت على قواعد السلوك الوظيفي واللوائح المنظّمة للعمل داخل الشركة، " +
    "وألتزم بالانضباط واحترام الزملاء وإجراءات السلامة والأمن، وأتحمّل مسؤولية أي مخالفة.",
  other: "",
};

export function acknowledgmentTypeLabel(type: AcknowledgmentType, t: Dictionary): string {
  return t.acknowledgments.types[type];
}
