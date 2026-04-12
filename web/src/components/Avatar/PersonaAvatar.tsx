import React from "react";
import { getInitials, getAvatarColor } from "../../utils/avatar";

interface PersonaAvatarProps {
  personaId: string;
  displayName: string;
  size?: number;
  avatarEmoji?: string;
  avatarImage?: string;
  className?: string;
  statusClass?: string;
  showStatus?: boolean;
  style?: React.CSSProperties;
}

export function PersonaAvatar({
  personaId,
  displayName,
  size = 36,
  avatarEmoji,
  avatarImage,
  className,
  statusClass,
  showStatus = false,
  style,
}: PersonaAvatarProps) {
  const resolvedBackground = avatarImage
    ? "transparent"
    : avatarEmoji
      ? "var(--ei-bg-tertiary)"
      : getAvatarColor(personaId);

  const containerStyle: React.CSSProperties = {
    width: size,
    height: size,
    background: resolvedBackground,
    ...style,
  };

  const classes = ["ei-persona-avatar", className].filter(Boolean).join(" ");

  return (
    <div className={classes} style={containerStyle}>
      {avatarImage ? (
        <img
          src={avatarImage}
          alt={displayName}
          style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
        />
      ) : avatarEmoji ? (
        avatarEmoji
      ) : (
        getInitials(displayName)
      )}
      {showStatus && statusClass && (
        <span className={`ei-persona-avatar__status ${statusClass}`} />
      )}
    </div>
  );
}
