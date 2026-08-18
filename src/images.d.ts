declare module "*.jpg" {
  const content: string;
  export default content;
}

declare module "*.png" {
  const content: string;
  export default content;
}

declare module "@alicloud/pop-core" {
  const Core: any;
  export default Core;
}
