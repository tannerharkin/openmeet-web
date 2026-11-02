import * as React from "react";

type Props = Record<string, unknown> & { children?: React.ReactNode };

function create(type: React.ElementType, props: Props, key?: React.Key) {
  const { children, ...rest } = props;
  const withKey = key === undefined ? rest : { ...rest, key };
  return Array.isArray(children)
    ? React.createElement(type, withKey, ...children)
    : children === undefined
      ? React.createElement(type, withKey)
      : React.createElement(type, withKey, children);
}

export const Fragment = React.Fragment;
export const jsx = create;
export const jsxs = create;
export const jsxDEV = create;
