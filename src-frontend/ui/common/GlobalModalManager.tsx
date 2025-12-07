import React from "react";
import { Settings } from "../Settings";
import { PasswordModal } from "./PasswordModal";
import { WarningModal } from "./WarningModal";
import { InputModal } from "./InputModal";

interface GlobalModalManagerProps {
    pendingQuit: boolean;
    onForceQuit: () => void;
}

export const GlobalModalManager: React.FC<GlobalModalManagerProps> = ({ 
    pendingQuit, 
    onForceQuit 
}) => {
  return (
    <>
      <Settings />
      <PasswordModal />
      <InputModal />
      <WarningModal 
        onConfirm={pendingQuit ? onForceQuit : undefined}
        confirmText="Quit Anyway"
      />
    </>
  );
};