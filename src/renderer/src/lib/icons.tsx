import type { JSX } from "react";
import { Lightning, Warning, X } from "@phosphor-icons/react";

interface IconProps {
  className?: string;
}

export function IconBolt(props: IconProps): JSX.Element {
  return <Lightning className={props.className} weight="fill" aria-hidden="true" />;
}

export function IconWarning(props: IconProps): JSX.Element {
  return <Warning className={props.className} weight="regular" aria-hidden="true" />;
}

export function IconClose(props: IconProps): JSX.Element {
  return <X className={props.className} weight="regular" aria-hidden="true" />;
}
