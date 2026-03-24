/**
 * UI labels for pending action types.
 * Used by channel adapters (WhatsApp buttons, SSE events) to render
 * action-type-specific prompts without knowing the action details.
 */

interface ActionLabels {
  prompt: string;
  confirm: string;
  cancel: string;
}

const ACTION_LABELS: Record<string, ActionLabels> = {
  "send-email": { prompt: "¿Enviar este email?", confirm: "Enviar", cancel: "Cancelar" },
  "create-event": { prompt: "¿Crear este evento?", confirm: "Crear", cancel: "Cancelar" },
};

export function getActionLabels(actionType: string): ActionLabels {
  return ACTION_LABELS[actionType] ?? { prompt: "¿Confirmar esta acción?", confirm: "Confirmar", cancel: "Cancelar" };
}
