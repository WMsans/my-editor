import React from "react";
import { Settings } from "../Settings";
import { PasswordModal } from "./PasswordModal";
import { WarningModal } from "./WarningModal";

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
      <WarningModal 
        onConfirm={pendingQuit ? onForceQuit : undefined}
        confirmText="Quit Anyway"
      />
    </>
  );
};