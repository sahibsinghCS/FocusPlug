import type { JSX, ReactNode } from "react";
import { PageFrame, PageHeader } from "../../../components/page";

export function ConfigPage(props: { children: ReactNode }): JSX.Element {
  return <PageFrame width="narrow">{props.children}</PageFrame>;
}

export function ConfigHeader(props: {
  kicker: string;
  title: string;
  description: string;
  meta?: string;
  actions?: ReactNode;
}): JSX.Element {
  return (
    <PageHeader
      kicker={props.kicker}
      title={props.title}
      description={props.description}
      meta={props.meta}
      actions={props.actions}
    />
  );
}
