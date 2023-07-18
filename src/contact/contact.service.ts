import { Logger, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LINK_PRECEDENCE } from 'src/utils/Enums';
import { Repository } from 'typeorm';
import { CreateContactDto } from './dto/create-contact.dto';
import { IdentifyContactResponseDto } from './dto/identify-contact-response.dto';
import { Contact } from './entities/contact.entity';

@Injectable()
export class ContactService {
  private readonly logger = new Logger('ContactService');
  constructor(
    @InjectRepository(Contact)
    private readonly contactRepository: Repository<Contact>,
  ) {}

  async identifyContacts(
    createContactDto: CreateContactDto,
  ): Promise<IdentifyContactResponseDto> {
    let primaryContact: Contact | undefined;
    let secondaryContacts: Contact[] = [];
    let primaryContactsWithMatchingEmail: Contact[] = [];
    let primaryContactsWithMatchingPhoneNo: Contact[] = [];
    try {
      const { email, phoneNumber } = createContactDto;
      if (email) {
        primaryContactsWithMatchingEmail = await this.contactRepository.find({
          where: { email },
          order: { createdAt: 'ASC' },
        });
        this.logger.log({ primaryContactsWithMatchingEmail });
      }

      if (phoneNumber) {
        primaryContactsWithMatchingPhoneNo = await this.contactRepository.find({
          where: { phoneNumber },
          order: { createdAt: 'ASC' },
        });
        this.logger.log({ primaryContactsWithMatchingPhoneNo });
      }

      primaryContact = await this.findPrimaryContact(
        primaryContactsWithMatchingEmail,
        primaryContactsWithMatchingPhoneNo,
      );

      if (Object.keys(primaryContact).length === 0) {
        this.logger.log(
          `no existing primary contact found, creating new one...`,
        );
        const newContact = await this.createPrimaryContact(email, phoneNumber);
        this.logger.log(`new primary contact: ${JSON.stringify(newContact)}`);
        return this.fetchIdentifyResponse(newContact, [], [newContact]);
      }

      if (
        primaryContact.email != email ||
        primaryContact.phoneNumber != phoneNumber
      ) {
        // create a secondary contact.
        // TODO: make a get request with email and phoneNo.
        const existingContact = await this.contactRepository.findOne({
          where: { email, phoneNumber },
        });

        this.logger.log(` existingContact: ${JSON.stringify(existingContact)}`);
        if (!existingContact) {
          const linkedId = primaryContact.linkedId ?? primaryContact.id;
          this.logger.log(`linkedId: ${linkedId}`);
          await this.createSecondaryContact(linkedId, email, phoneNumber);
        }
      }

      secondaryContacts = await this.contactRepository.find({
        where: { linkedId: primaryContact.id },
      });

      const linkedContacts = [primaryContact, ...secondaryContacts];
      return this.fetchIdentifyResponse(
        primaryContact,
        secondaryContacts,
        linkedContacts,
      );
    } catch (err) {
      this.logger.error(
        `Error occurred while fetching contact identities: ${err.message}`,
      );
    }
  }

  fetchIdentifyResponse = (
    primaryContact: Contact,
    secondaryContacts: Contact[],
    linkedContacts: Contact[],
  ) => {
    const contactIdentify: IdentifyContactResponseDto = {
      contact: {
        primaryContactId: primaryContact.id,
        emails: [
          ...new Set(
            linkedContacts
              .map((contact) => contact.email)
              .filter((email) => email !== undefined && email !== null),
          ),
        ],
        phoneNumbers: [
          ...new Set(
            linkedContacts
              .map((contact) => contact.phoneNumber)
              .filter(
                (phoneNumber) =>
                  phoneNumber !== undefined && phoneNumber !== null,
              ),
          ),
        ],
        secondaryContactIds: [
          ...secondaryContacts.map((contact) => contact.id),
        ],
      },
    };

    this.logger.log(`Identify Contact: ${JSON.stringify(contactIdentify)}`);
    return contactIdentify;
  };
  async createPrimaryContact(
    email: string | null,
    phoneNumber: string | null,
  ): Promise<Contact> {
    const contactObj = new Contact();
    contactObj.email = email;
    contactObj.phoneNumber = phoneNumber;
    contactObj.createdAt = new Date();
    contactObj.linkPrecedence = LINK_PRECEDENCE.PRIMARY;
    contactObj.linkedId = null;
    const createdContact = await this.contactRepository.save(contactObj);
    this.logger.log(`Contact created: ${JSON.stringify(createdContact)}`);
    return createdContact;
  }

  async createSecondaryContact(
    linkedId: number,
    email: string | null,
    phoneNumber: string | null,
  ): Promise<void> {
    const contactObj = new Contact();
    contactObj.email = email;
    contactObj.phoneNumber = phoneNumber;
    contactObj.createdAt = new Date();
    contactObj.linkPrecedence = LINK_PRECEDENCE.SECONDARY;
    contactObj.linkedId = linkedId;
    const secondaryContact = await this.contactRepository.save(contactObj);
    this.logger.log(
      `Secondary Contact created: ${JSON.stringify(secondaryContact)}`,
    );
  }

  findPrimaryContact = async (
    primaryContactsWithMatchingEmail: Contact[],
    primaryContactsWithMatchingPhoneNo: Contact[],
  ) => {
    let primaryContact: any = {};
    let secondaryContact: any = {};
    // if both are primary contacts based on matching no. and email choose the oldest as the primary contact
    if (
      primaryContactsWithMatchingEmail.length > 0 &&
      primaryContactsWithMatchingPhoneNo.length > 0
    ) {
      primaryContact = primaryContactsWithMatchingEmail[0];
      secondaryContact = primaryContactsWithMatchingPhoneNo[0];
      if (
        primaryContactsWithMatchingEmail[0].createdAt >
        primaryContactsWithMatchingPhoneNo[0].createdAt
      ) {
        primaryContact = primaryContactsWithMatchingPhoneNo[0];
        secondaryContact = primaryContactsWithMatchingEmail[0];
      }

      // update primary information.
      this.updateContactLinkPrecedence(secondaryContact, primaryContact.id);
    } else {
      if (primaryContactsWithMatchingEmail.length > 0) {
        primaryContact = primaryContactsWithMatchingEmail[0];
      }
      if (primaryContactsWithMatchingPhoneNo.length > 0) {
        primaryContact = primaryContactsWithMatchingPhoneNo[0];
      }
    }

    if (primaryContact.linkPrecedence === LINK_PRECEDENCE.SECONDARY) {
      this.logger.log(
        `fetching main primary contact for ${JSON.stringify(primaryContact)}`,
      );
      primaryContact = await this.contactRepository.findOne({
        where: { id: primaryContact.linkedId },
      });
      this.logger.log(
        `updated primary contact: ${JSON.stringify(primaryContact)}`,
      );
    }
    return primaryContact;
  };

  async updateContactLinkPrecedence(contact: Contact, linkedId: number) {
    contact.linkPrecedence = LINK_PRECEDENCE.SECONDARY;
    contact.linkedId = linkedId;
    contact.updatedAt = new Date();
    this.logger.log(
      `Update contact linkPrecedence: ${JSON.stringify(contact)}`,
    );
    return await this.contactRepository.update(contact.id, contact);
  }

  async create(createContactDto: CreateContactDto): Promise<Contact> {
    try {
      const contactObj = new Contact();
      contactObj.email = createContactDto.email;
      contactObj.phoneNumber = createContactDto.phoneNumber;
      contactObj.createdAt = new Date();
      contactObj.linkPrecedence = LINK_PRECEDENCE.PRIMARY;
      contactObj.linkedId = null;
      this.logger.log(`Create Contact Obj: ${JSON.stringify(contactObj)}`);
      return await this.contactRepository.save(contactObj);
    } catch (err) {
      this.logger.error(
        `Error occurred while creating contact: ${err.message}`,
      );
    }
  }

  async findAll(): Promise<Contact[]> {
    try {
      return await this.contactRepository.find();
    } catch (err) {
      this.logger.error(
        `ContactService: Error occurred while fetching contacts: ${err.message}`,
      );
    }
  }

  findOne(id: number) {
    return `This action returns a #${id} contact`;
  }

  remove(id: number) {
    return `This action removes a #${id} contact`;
  }
}
