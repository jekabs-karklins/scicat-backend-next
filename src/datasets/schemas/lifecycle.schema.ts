import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document } from "mongoose";

export type LifecycleDocument = Lifecycle & Document;

@Schema()
export class Lifecycle {
  @Prop()
  id: string;

  @Prop({ default: true })
  archivable: boolean;

  @Prop({ default: false })
  retrievable: boolean;

  @Prop({ default: true })
  publishable: boolean;

  @Prop({ type: Date, default: Date.now() })
  dateOfDiskPurging: Date;

  @Prop({ type: Date, default: Date.now() })
  archiveRetentionTime: Date;

  @Prop({ type: Date, default: Date.now() })
  dateOfPublishing: Date;

  @Prop({ type: Date, default: Date.now() })
  publishedOn: Date;

  @Prop({ default: true })
  isOnCentralDisk: boolean;

  @Prop()
  archiveStatusMessage: string;

  @Prop()
  retrieveStatusMessage: string;

  @Prop({ type: Object })
  archiveReturnMessage: unknown;

  @Prop({ type: Object })
  retrieveReturnMessage: unknown;

  @Prop()
  exportedTo: string;

  @Prop({ default: true })
  retrieveIntegrityCheck: boolean;
}

export const LifecycleSchema = SchemaFactory.createForClass(Lifecycle);
